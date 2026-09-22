# Changelog

## 0.106.0

- Use `AgentEnvironmentProvider` as the single execution contract for turns, persistent sessions, interactions, supervision, delegation, and benchmark runs.
- Replace the `/conversation` entry point and `runConversation` with `/interaction` and `runInteraction`.
- Replace the old session, sandbox-run, backend, and `runLoop` APIs with `streamAgentTurn`, `openEnvironmentRun`, `runInteraction`, `runAgentRounds`, and `runStrategy`.
- Make `supervise` and `delegate` accept a provider-backed `worker`; remove `ProviderSeam`, `ExecutorConfig`, and `createExecutor`.
- Add local, in-process, inline, Router, CLI Bridge, and Tangle Sandbox provider adapters behind the same contract.
- Remove the public persona combinators and `worktreeFanout`; use `worktreeLoopRunner` for parallel repository workers.
- Require `@tangle-network/agent-eval` 0.129.0 and its explicit run outcome, cost provenance, scenario identity, and canonical task-failure contract.
- Update `@tangle-network/agent-interface` to 0.34.0, `@tangle-network/agent-knowledge` to 6.0.0, `@tangle-network/sandbox` to 0.13.0, and `@tangle-network/agent-profile-materialize` to 0.9.0.
- Keep Runtime and Bench on one checked dependency set.
- Update the supported TypeScript 6, pnpm 10, test, build, formatting, and browser toolchain.
- Reject incomplete adapter and benchmark-report run records instead of filling missing identity, token, or outcome fields.
- Remove `applyRunRecordDefaults`; adapters must emit complete current records.
- Remove `RunLoopOptions`, detached `sandboxClient`, and `cappedOut` compatibility surfaces.
- Require canonical runner names such as `claude-code`; `LocalHarness` no longer accepts `claude`.
- Bind activation records through the single `candidateDigest` field required by Agent Interface 0.34.
- Remove `providerAsSandboxClient`; current execution flows consume `AgentEnvironmentProvider` directly.
- Replace the old Intelligence manifest and profile-diff APIs with immutable, tenant-bound context containing only inline guidance and safe files.
- Require exact target and SHA-256 checks, application-approved origins, call-time authorization, JSON Schema validation, bounded requests and responses, and no redirects.
- Treat a revisioned `revoked` response as removal; reject a 404 as an incompatible endpoint without erasing the last valid context.
- Stop composing certified context once it expires, including during a long-running agent call.
- Bound telemetry queues, request time, and response bytes; retry temporary delivery failures with capped backoff and report dropped spans.
- Preserve canonical control failure classes, including knowledge-readiness stops.
- Retry generated-strategy analyst calls at temperature 1 when a provider rejects lower values.
- Emit task outcomes on OTel run roots and model usage on child spans in every example.

## 0.105.0

- Add `officialGepa(...)` and `officialSkillOpt(...)` as Runtime adapters over the upstream GEPA and Microsoft SkillOpt implementations in `@tangle-network/agent-eval`.
- Require one complete `OptimizationMethod` for profile improvement and keep final-test scenarios outside optimizer input.
- Authorize every exact execution-capable profile candidate before it reaches an agent.
- Preserve resumed optimizer spend, model identity, package provenance, and separate optimization versus final-test costs in activation receipts.
- Verify released Python packages, pinned source revisions, resume behavior, concurrency, and packed external installs in CI.
- Keep code improvement on Runtime-owned isolated Git worktrees.
- Remove the retired local prompt, profile-diff, campaign OTLP, and record-only optimizer paths.
- Require `@tangle-network/agent-eval` 0.126.x.

## 0.104.0

- Add the Tangle Sandbox exact-process environment provider for verified candidate execution.

## 0.103.1

- Declare and test compatibility with `@tangle-network/agent-eval` 0.125.x; runtime behavior is unchanged.
