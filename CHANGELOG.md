# Changelog

## 0.107.5

- Replace the invalid paired t-test in benchmark reports with `@tangle-network/agent-eval`'s cross-checked Wilcoxon signed-rank test.
- Report non-zero pairs, test method, attainable p-value floor, raw p-value, adjusted q-value, and explicit ties for every profile comparison.
- Align Runtime with `@tangle-network/agent-eval` 0.133.3 and `@tangle-network/agent-knowledge` 6.1.5, and derive packaged comparison sizes from Eval's minimum.

## 0.107.4

- Pack `@tangle-network/agent-interface` from its exact source commit alongside Eval, Knowledge, and Runtime before merge and publish.
- Align Runtime with `@tangle-network/agent-eval` 0.133.2 and `@tangle-network/agent-knowledge` 6.1.4.
- Resolve local archive overrides at the pnpm workspace root for nested packages.

## 0.107.3

- Add public proposal and private activation fixtures for profile-improvement consumer tests.
- Verify the exact Eval, Knowledge, and Runtime package archives together before merge and publish.
- Align the tested package cohort with `@tangle-network/agent-eval` 0.133.1, `@tangle-network/agent-knowledge` 6.1.3, and `@tangle-network/sandbox` 0.15.1.

## 0.107.2

- Align Runtime's tested Sandbox dependency and public peer contract with `@tangle-network/sandbox` 0.15.0.

## 0.107.1

- Add a budget-bound profile improvement cycle that turns trace findings into exact, reviewable profile proposals.
- Preserve one shared cost budget and the final-test split through analysis, optimization, measurement, review, and activation.
- Align Runtime with `@tangle-network/agent-eval` 0.133.0, `@tangle-network/agent-interface` 0.36.0, and `@tangle-network/agent-knowledge` 6.1.2.
- Check the packed `proposeAgentProfileImprovement` export so the public entrypoint cannot disappear silently.

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
