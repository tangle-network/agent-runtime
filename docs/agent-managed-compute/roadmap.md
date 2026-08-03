# Implementation Roadmap

## Completion Definition

Agent-managed compute is complete when an external developer can start one dynamic run with a profile and budget, observe and steer its agents, kill and restart the coordinator without duplicate work, use at least two real compute providers, and receive one checked result with complete usage and trace records.

The work is ordered to prove the two-agent atom before adding scale.

## Phase 0: Documentation Truth

**Owner:** `agent-runtime`

**Work:**

- Make this directory the canonical plan.
- Correct claims that supervised trees already resume.
- Distinguish call-routing headers from coordination state.
- Mark historical scripts as experiments until they produce machine-checked artifacts.

**Complete when:**

- Current capabilities and gaps are stated without contradiction.
- Every completion claim links to a test or persisted live run.
- No new document describes the in-memory event bus as durable.

## Phase 1: One Interaction Model

**Owner:** `agent-runtime`

**Work:**

- Upgrade `agent-knowledge`, `agent-eval`, `agent-interface`, and `sandbox` to their current compatible release lines.
- Add a package-direction check that rejects any `agent-knowledge` import from `agent-runtime`.
- Define one internal run state used by dynamic drivers and scheduled actor turns.
- Make `runAgent` the simple root-profile entry point.
- Make `runInteraction` the explicit multi-actor entry point.
- Implement conversation turn order as an interaction policy.
- Implement personified and agentic modes as policy helpers.
- Make `runAgentRounds` an internal sandbox batch implementation.
- Keep existing exports as deprecated wrappers for one release cycle.

**Complete when:**

- Runtime and knowledge install one compatible copy of each shared contract package.
- `agent-knowledge` builds and tests without `agent-runtime` installed.
- One two-agent test exercises the shared state through both dynamic and alternating policies.
- All existing public behavior tests pass through the new internal path.
- New examples need no knowledge of `runAgentRounds`, `Supervisor` construction, or MCP server wiring.
- Generated API documentation shows one recommended run path and one advanced multi-actor path.

## Phase 2: Durable Run Ownership And Recovery

**Owners:** `agent-interface`, `agent-runtime`

**Work:**

- Extend the existing run record with revisions, ownership generation, commands, provider references, and coordination events.
- Add durable adapters with conditional writes.
- Persist dispatch intent before provider creation.
- Add a durable provider-command outbox with coordinator generation and command sequence.
- Rebuild budget reservations and interaction state on restart.
- Adapt `SpawnJournal`, `ConversationJournal`, and delegation status onto the shared internal record.
- Preserve separate public adapters only where compatibility requires them.

**Complete when:**

- Killing the coordinator at every invocation transition resumes or reports an honest terminal failure.
- A stale coordinator cannot append after failover.
- A delayed stale-coordinator command cannot steer, cancel, or accept provider work after failover.
- Two concurrent submissions with the same idempotency key start one physical invocation.
- Questions, answers, and steering commands survive restart.
- Actual spend after recovery matches provider events.

## Phase 3: Provider Session Control

**Owners:** provider packages, `agent-runtime`

**Work:**

- Use `AgentEnvironmentProvider` as the only remote compute boundary.
- Add capability checks for session continuation, event replay, steering, cancellation, workspace, and usage.
- Add `deliver` and reconnect behavior to the provider-backed executor where supported.
- Require provider-side generation fencing or a fenced session broker for multi-round failover.
- Store environment, session, and event cursor references in the run record.
- Add provider-resource reconciliation and orphan cleanup by run and invocation metadata.
- Reuse the shared provider conformance tests.

**Complete when:**

- Tangle sandbox and CLI bridge pass the same required provider tests.
- One additional provider, such as ComputeSDK, E2B, or Daytona, passes the minimum tests.
- A policy that requires unsupported capabilities fails before dispatch.
- A live session continues after coordinator restart without restarting the agent.
- A delayed command from the old coordinator is rejected after ownership changes.
- Orphaned provider resources are found and closed within the configured cleanup interval.

## Phase 4: Secure Coordination MCP

**Owner:** `agent-runtime`

**Work:**

- Make coordination MCP handlers call durable run commands.
- Add short-lived run-scoped authentication.
- Add request size, deadline, rate, and concurrency limits.
- Reject non-loopback binding without authentication.
- Emit structured action records with actor and command ids.

**Complete when:**

- Unauthenticated, expired, wrong-run, and wrong-actor calls are rejected.
- Retried MCP tool calls return the original command result.
- MCP server restart does not lose status or unread events.
- A security review finds no path to steer another run.

## Phase 5: Parallel Workspaces And Integration

**Owners:** `agent-runtime`, provider packages

**Work:**

- Standardize isolated workspace creation and immutable result commits.
- Record base and produced revisions on each invocation.
- Add one integration-owner policy for merges.
- Turn merge conflicts into explicit follow-up work.
- Support shared writable workspaces only as an opt-in provider capability.

**Complete when:**

- Eight agents can edit in parallel without silent overwrite.
- Replaying a completed invocation does not create a second commit.
- A stale-base result is rejected or explicitly merged.
- Every accepted coding result has passing deterministic checks and a durable revision.

## Phase 6: Agent-Managed Scaling

**Owners:** `agent-runtime`, provider packages

**Work:**

- Let the driver choose provider, model, profile, and child budget from declared capabilities and policy limits.
- Add provider quotas, creation backoff, and per-run concurrency.
- Support recursive sub-drivers under the same run ownership and budget.
- Add compact durable driver state for long runs and fresh-context continuation.

**Complete when:**

- A driver can run 32 child invocations with a configured live cap of 8.
- Recursive sub-drivers cannot exceed root budget, depth, or provider quota.
- Provider failure redirects only when policy allows and does not duplicate accepted effects.
- The coordinator stays responsive while all worker slots are occupied.

## Phase 7: Evaluation And Knowledge Workloads

**Owners:** `agent-eval`, `agent-bench`, `agent-knowledge`, `agent-runtime`

**Work:**

- Store run records in the shared `agent-eval` analysis format.
- Add reusable distributed-recovery and multi-agent benchmark suites to `agent-bench`.
- Add an `agent-knowledge` workload where agents ingest, repair, evaluate, and improve a knowledge base across resumable runs.
- Compare dynamic allocation against equal-compute fixed policies.
- Keep train and held-out evaluation data separate.

**Complete when:**

- Every benchmark reports task success, accepted output, child count, retries, duplicate suppression, tokens, cost, duration, provider placement, recovery count, and orphan count.
- Dynamic allocation beats or matches the fixed equal-compute baseline on fresh tasks without worse reliability.
- The knowledge workload improves held-out retrieval or answer metrics and records every knowledge mutation with provenance.
- Null results are reported as open unless the experiment has enough power and isolates one mechanism.

## Phase 8: Public Cleanup

**Owner:** `agent-runtime`

**Work:**

- Remove deprecated wrappers after one release and migration window.
- Shrink `/mcp` exports to supported agent-facing tools and configuration.
- Keep persistence internals and transport helpers private.
- Replace duplicate examples with one local example, one remote example, and one recovery example.
- Update README, concepts, architecture, and generated API documentation.

**Complete when:**

- A new developer can choose the correct API from a two-row decision table.
- The basic dynamic run fits in roughly 10 lines of application code.
- No public entry point exposes internal journal, server, or sandbox batch construction for the common path.
- Every shipped example runs in CI or is explicitly marked as a credentialed live test.

## Recommended Merge Slices

Each slice should be independently reviewable and revertible:

1. shared run state types and in-memory adapter,
2. transactional run store and ownership tests,
3. provider-backed reconnectable executor,
4. two-agent recovery path,
5. durable coordination commands and events,
6. authenticated MCP adapter,
7. conversation policy migration,
8. personified and agentic policy migration,
9. workspace integration owner,
10. live provider tests and `agent-bench` suites,
11. public export cleanup.

Do not combine storage recovery, public renames, and provider migration in one pull request.
