# Changelog

## 0.106.0

- Align Runtime with `@tangle-network/agent-eval` 0.131.0, `@tangle-network/agent-interface` 0.35.0, `@tangle-network/agent-knowledge` 6.1.1, `@tangle-network/agent-profile-materialize` 0.9.0, and `@tangle-network/sandbox` 0.14.0.
- Require maintained Node 22.13 or newer, use pnpm 11.17.0, and use the newest TypeScript supported by TypeDoc.
- Require the matching Runtime peer ranges so incompatible consumers fail installation instead of mixing profile contracts.
- Record the exact tool-step count in candidate receipts and validate optimizer evidence on both candidate and profile comparisons.
- Reject secret values hidden in Sandbox passthrough options and rank measured cost ahead of unknown cost when quality ties.
- Remove `reportLoopUsage`; campaign integrations must use `loopDispatch` or `loopCampaignDispatch` so Eval admits paid work before execution and records its receipt.

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
