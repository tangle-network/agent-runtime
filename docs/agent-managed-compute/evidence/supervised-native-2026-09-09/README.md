# Runtime #773: supervised native workers survive coordinator loss

Two native Codex workers survived SIGKILL of their original coordinator.
A separate replacement process attached their exact persisted Runtime bindings and matched every original output frame by sequence and SHA-256.
The corrected run matched 184/184 and 188/188 original frames.
Fresh control stopped the first worker while its sibling remained running, then stopped the sibling.
Both environments were deleted and their absence was verified.
`cleanup-inventory.matchingSandboxes: 2` counts the pre-deletion matched list; it does not count environments remaining after cleanup.

## Evidence

- `attempt-b/` preserves the first live attempt, including its exit code 1 and incomplete stop proof.
- `attempt-c/` contains the corrected script, process records, persisted journal, bindings, and summary.
- Each script used an empty initial prompt and only terminal `/help` input; no model prompt was sent by the proof.
- Original output is represented only by ordered sequence numbers and SHA-256 hashes.

The first attempt reused a control claim after detaching its terminal.
SDK 0.38.2 releases that claim when the stream closes, and provider stop revalidates control.
The corrected attempt acquires fresh control immediately before each stop.
The offline SDK test `releases a closed stream claim and reclaims authority before reconnect` passed (1 passed, 60 skipped).
The first attempt discarded the actual provider error message and HTTP status; those remain unknown.

## Scope and reproduction

This proves native worker identity, persisted binding recovery after coordinator process loss, ordered replay, and independent stop authority.
It does not prove supervisor scheduling recovery, a Braid restart, environment expiry, or local Bridge conformance.
CPU, memory, disk, lifetime, and blocked egress values were requested; enforcement was not measured.
No model usage receipt or cost measurement was collected.
The scripts requested at most two simultaneous environments per attempt, each with 1 CPU, 1024 MB memory, and 1 GB disk.
Requested maximum lifetime was 300 seconds and idle timeout was 180 seconds.

Runtime source was pinned to `0c45a1035d29f90303a61ddb2b879039ad87c987`.
Dependencies were Sandbox SDK 0.38.2, provider-tangle 1.1.6, and agent-interface 2.6.0.
Set `RUNTIME_SOURCE`, `SANDBOX_CLI_SOURCE`, and `EXPECTED_SANDBOX_EMAIL` before running `tsx executed-proof.mts orchestrate UNIQUE_NAME`.
The maintained Sandbox CLI supplies credentials; the proof verifies account ownership without publishing identity or credentials.
Use a fresh run name and an empty evidence directory.

## Issue #773 acceptance disposition

This table reports only what these live records establish.
Other implementation or offline evidence can satisfy additional parts of the issue.

| Criterion | Disposition from this proof |
|---|---|
| 1. Stable sandbox execution handle | Passed for two native Codex workers started through Runtime. |
| 2. Input, two resizes, detach, reconnect, ordered history | Passed using `/help`, two resizes, and exact original frame sequence/hash comparison. |
| 3. Process continues detached | Passed for both workers before and after coordinator loss. |
| 4. Braid restart rediscovers run | Not tested. Replacement Runtime attachment does not establish Braid restart behavior. |
| 5. Selected attachment reaches exact child | Passed for distinct worker, environment, and execution identities with the same persisted root parent. |
| 6. Cancellation, close, transport loss, expiry remain distinct | Partial. Detach preserved running state; acknowledged stops produced exited state; coordinator loss preserved workers. Expiry was not tested. |
| 7. Headless execution unavailable | Not tested by this native terminal proof. |
| 8. Secrets remain transient | Published records contain no credentials or transport URLs; this is not a comprehensive secrets-lifecycle audit. |
| 9. Sandbox and local Bridge conformance | Sandbox live path exercised; local Bridge not tested. |

The issue remains open on the untested criteria.
This evidence adds no claim of complete scheduler recovery or distributed coordinator failover.
